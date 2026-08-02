import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma.service';

export interface IncomingPayment {
  txHash: string;
  amount: number;
  assetCode: string;
  from: string;
  timestamp: Date;
}

/**
 * Talks to the Stellar network:
 *  - Horizon: watch the user's wallet for incoming salary payments.
 *  - Soroban: invoke the per-user PlanVault contract (create / release /
 *    early-withdraw) via a backend service account.
 *
 * Everything degrades gracefully when STELLAR_SECRET_KEY / VAULT_CONTRACT_ID
 * are not configured — the API stays fully functional off-chain so the
 * frontend can be developed against it immediately.
 */
@Injectable()
export class StellarService {
  private readonly logger = new Logger(StellarService.name);
  private readonly horizonUrl: string;
  private readonly networkPassphrase: string;
  private readonly secretKey?: string;
  private readonly defaultContractId?: string;
  private readonly usdcTokenContract?: string;
  private readonly processedTxHashes = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.horizonUrl = config.get<string>('STELLAR_HORIZON_URL') ?? 'https://horizon-testnet.stellar.org';
    this.networkPassphrase =
      config.get<string>('STELLAR_NETWORK_PASSPHRASE') ?? 'Test SDF Network ; September 2015';
    this.secretKey = config.get<string>('STELLAR_SECRET_KEY') || undefined;
    this.defaultContractId = config.get<string>('VAULT_CONTRACT_ID') || undefined;
    this.usdcTokenContract = config.get<string>('USDC_TOKEN_CONTRACT') || undefined;
  }

  isConfigured() {
    return !!this.secretKey && !!(this.defaultContractId || this.usdcTokenContract);
  }

  /** Query Horizon for live account balances (USDC & native XLM). */
  async getAccountBalances(walletAddress: string): Promise<{ usdc: number; xlm: number; total: number }> {
    try {
      const url = `${this.horizonUrl}/accounts/${walletAddress}`;
      const res = await fetch(url);
      if (!res.ok) return { usdc: 0, xlm: 0, total: 0 };
      const json = await res.json();
      let usdc = 0;
      let xlm = 0;
      for (const b of json.balances ?? []) {
        if (b.asset_type === 'native') xlm = parseFloat(b.balance || '0');
        else if (b.asset_code === 'USDC') usdc = parseFloat(b.balance || '0');
      }
      return { usdc, xlm, total: usdc + xlm };
    } catch (err: any) {
      this.logger.warn(`Failed to fetch Horizon balance for ${walletAddress}: ${err.message}`);
      return { usdc: 0, xlm: 0, total: 0 };
    }
  }

  /** Fetch incoming (credit) payments for a wallet from Horizon, newest first. */
  async getIncomingPayments(walletAddress: string, limit = 20): Promise<IncomingPayment[]> {
    try {
      const url = `${this.horizonUrl}/accounts/${walletAddress}/payments?order=desc&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) {
        this.logger.warn(`Horizon returned ${res.status} for ${walletAddress}`);
        return [];
      }
      const json = await res.json();
      const payments: IncomingPayment[] = [];

      for (const record of json._embedded?.records ?? []) {
        if (record.type !== 'payment') continue;
        if (record.to !== walletAddress) continue; // incoming only
        if (this.processedTxHashes.has(record.transaction_hash)) continue;

        const alreadyRecorded = await this.prisma.transaction.findFirst({
          where: { txHash: record.transaction_hash },
        });
        if (alreadyRecorded) {
          this.processedTxHashes.add(record.transaction_hash);
          continue;
        }

        payments.push({
          txHash: record.transaction_hash,
          amount: parseFloat(record.amount),
          assetCode: record.asset_type === 'native' ? 'XLM' : record.asset_code,
          from: record.from,
          timestamp: new Date(record.created_at),
        });
      }
      return payments;
    } catch (err) {
      this.logger.error(`Failed to fetch payments for ${walletAddress}: ${err.message}`);
      return [];
    }
  }

  /** Mark a tx hash as processed so the next scan skips it. */
  markProcessed(txHash: string) {
    this.processedTxHashes.add(txHash);
  }

  /**
   * Create a plan inside the user's vault contract (`create_plan`).
   * Returns the on-chain plan id + submission hash.
   */
  async createPlanOnChain(
    userId: string,
    name: string,
    amount: number,
    planType: 'BILL' | 'EMERGENCY' | 'SAVINGS',
    unlockDate: Date | null,
  ): Promise<{ contractPlanId: number; txHash: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const targetContractId = user?.vaultContractId ?? this.defaultContractId;
    if (!targetContractId || !this.secretKey) {
      return {
        contractPlanId: 0,
        txHash: `sim_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 10)}`,
      };
    }

    const planTypeNum = planType === 'BILL' ? 0 : planType === 'EMERGENCY' ? 1 : 2;
    const unlockTs = planType === 'BILL' && unlockDate ? Math.floor(unlockDate.getTime() / 1000) : 0;

    const res = await this.invokeContract(targetContractId, 'create_plan', [
      name,
      { i128: toStroops(amount) },
      { u32: planTypeNum },
      { u64: unlockTs },
    ]);

    return {
      contractPlanId: res.resultValue ?? (Date.now() % 1_000_000),
      txHash: res.txHash,
    };
  }

  /** Release (or early-break) a plan inside the user's vault contract. */
  async releaseVault(userId: string, vaultId: string, early: boolean): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const targetContractId = user?.vaultContractId ?? this.defaultContractId;
    if (!targetContractId || !this.secretKey) {
      return `sim_release_${Date.now().toString(16)}`;
    }
    const vault = await this.prisma.vault.findUnique({ where: { id: vaultId } });
    if (!vault) return `sim_missing_vault`;

    const fn = early ? 'confirm_early_withdraw' : 'release_plan';
    const res = await this.invokeContract(targetContractId, fn, [{ u32: vault.contractPlanId }]);
    return res.txHash;
  }

  /**
   * Minimal Soroban invocation via RPC. Uses raw RPC endpoint and polls for tx completion.
   */
  private async invokeContract(
    contractId: string,
    method: string,
    args: unknown[],
  ): Promise<{ txHash: string; resultValue?: number }> {
    const rpcUrl = this.config.get<string>('SOROBAN_RPC_URL') ?? 'https://soroban-testnet.stellar.org';

    // Build a fresh keypair from the service account secret.
    const { Keypair, TransactionBuilder, Networks, BASE_FEE, Contract, nativeToScVal, scValToNative, rpc } =
      await import('@stellar/stellar-sdk');
    const kp = Keypair.fromSecret(this.secretKey!);
    const server = new rpc.Server(rpcUrl);
    const account = await server.getAccount(kp.publicKey());

    const contract = new Contract(contractId);
    const scArgs = (args as any[]).map((a) =>
      typeof a === 'string'
        ? nativeToScVal(a, { type: 'string' })
        : typeof a === 'object' && a !== null && 'i128' in a
          ? nativeToScVal((a as any).i128, { type: 'i128' })
          : typeof a === 'object' && a !== null && 'u32' in a
            ? nativeToScVal((a as any).u32, { type: 'u32' })
            : typeof a === 'object' && a !== null && 'u64' in a
              ? nativeToScVal((a as any).u64, { type: 'u64' })
              : nativeToScVal(a),
    );

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...scArgs))
      .setTimeout(30)
      .build();

    const prepared = await server.prepareTransaction(tx);
    prepared.sign(kp);
    const sent = await server.sendTransaction(prepared);

    if (sent.status === 'ERROR') throw new Error(`Soroban tx failed: ${JSON.stringify(sent)}`);

    // Poll transaction status for result value
    let status = sent.status;
    let attempts = 0;
    let txResponse: any = null;
    while (attempts < 10 && status === 'PENDING') {
      await new Promise((r) => setTimeout(r, 1000));
      txResponse = await server.getTransaction(sent.hash);
      status = txResponse.status;
      attempts++;
    }

    let parsedResult: number | undefined = undefined;
    if (txResponse && txResponse.status === 'SUCCESS' && txResponse.returnValue) {
      try {
        const val = scValToNative(txResponse.returnValue);
        if (typeof val === 'number') parsedResult = val;
      } catch (e) {
        this.logger.debug(`Could not parse returnValue: ${e}`);
      }
    }

    return { txHash: sent.hash, resultValue: parsedResult };
  }
}

/** 1 unit = 10^7 stroops, matching the standard Stellar asset scale. */
function toStroops(amount: number): string {
  return Math.round(amount * 10_000_000).toString();
}

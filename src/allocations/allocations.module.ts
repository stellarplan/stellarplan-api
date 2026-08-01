import { Module } from '@nestjs/common';
import { StellarModule } from '../stellar/stellar.module';
import { VaultsModule } from '../vaults/vaults.module';
import { AllocationsController } from './allocations.controller';
import { AllocationsService } from './allocations.service';

@Module({
  imports: [StellarModule, VaultsModule],
  controllers: [AllocationsController],
  providers: [AllocationsService],
  exports: [AllocationsService],
})
export class AllocationsModule {}

import { AllocationsService } from './allocations.service';

describe('AllocationsService.allocate', () => {
  // reach the private helper through the prototype for a pure unit test
  const svc = Object.create(AllocationsService.prototype);

  const plans = [
    { id: 'a', category: 'rent', amount: 900, planType: 'BILL', unlockDay: 30 },
    { id: 'b', category: 'electricity', amount: 80, planType: 'BILL', unlockDay: 28 },
    { id: 'c', category: 'savings', amount: 400, planType: 'SAVINGS', unlockDay: null },
  ];

  it('fully funds plans when salary covers everything', () => {
    const out = (svc as any).allocate(2500, plans, 1380);
    expect(out.map((o: any) => o.amount)).toEqual([900, 80, 400]);
  });

  it('allocates proportionally when salary is short', () => {
    const out = (svc as any).allocate(690, plans, 1380);
    const total = out.reduce((acc: number, o: any) => acc + o.amount, 0);
    expect(total).toBeCloseTo(690, 5);
    expect(out[0].amount).toBeGreaterThan(out[1].amount);
  });

  it('returns nothing when total planned is zero', () => {
    expect((svc as any).allocate(1000, plans, 0)).toEqual([]);
  });
});

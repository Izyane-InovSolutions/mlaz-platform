// Tiers in order of price, as the landing page, the application form and the directory filter list them.
export const tiersByPrice = cfg => [...cfg.tiers].sort((a, b) => a.annualDues - b.annualDues);

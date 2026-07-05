const databaseUrl = process.env.DATABASE_URL ?? '';

if (!databaseUrl.includes('test')) {
  throw new Error(
    'Integration tests require DATABASE_URL pointing to a *_test database. ' +
      'Use: DATABASE_URL=postgresql://localhost:5432/qara-crm-test pnpm test:integration',
  );
}

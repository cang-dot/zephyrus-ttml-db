import { validateCatalog } from './library.mjs';

const { results } = await validateCatalog();
let publishedErrors = 0;

for (const result of results) {
  const marker = result.entry.status === 'published' ? 'PUBLISHED' : 'DRAFT';
  if (result.errors.length === 0) {
    console.log(`[${marker}] ${result.entry.id} ${result.entry.title}: valid`);
    continue;
  }

  const level = result.entry.status === 'published' ? 'ERROR' : 'REVIEW';
  console.log(`[${level}] ${result.entry.id} ${result.entry.title}`);
  for (const error of result.errors) console.log(`  - ${error}`);
  if (result.entry.status === 'published') publishedErrors += result.errors.length;
}

if (publishedErrors > 0) {
  console.error(`Validation failed with ${publishedErrors} published-entry error(s).`);
  process.exitCode = 1;
} else {
  console.log('All published TTML entries passed validation.');
}

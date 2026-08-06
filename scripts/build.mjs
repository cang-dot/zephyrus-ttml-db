import { buildLibrary } from './library.mjs';

const manifest = await buildLibrary();
console.log(
  `Built ${manifest.entries.length} published entries for library ${manifest.libraryVersion}.`
);

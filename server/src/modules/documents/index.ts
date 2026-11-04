// Documents: uploaded files and their records. Public interface for other modules' application layers and the platform.
export { type StoredFile, type UploadedFile, commitFiles, requireFile, storeFile, storeFiles } from './application/files.js';
export { assignApplicationDocuments, currentDocumentKinds, recordDocument, recordDocuments, supersedeMofDocuments } from './application/records.js';
export { sweepStorage } from './application/integrity.js';

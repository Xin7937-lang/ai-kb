// Public types for the retrieval layer. Kept in their own file so
// the retrieval module and the chat pipeline can import them without
// a circular dependency (retrieval.ts already exports the legacy
// `RetrievedNote` type for the old pipeline).

export type RetrievedChunk = {
  chunkId: number;
  noteId: string;
  title: string;
  content: string;
  tags: string[];
  score: number;
  paths: Array<'fts' | 'embedding'>;
};

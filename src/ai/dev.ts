import { config } from 'dotenv';
config();

import '@/ai/flows/summarize-document.ts';
import '@/ai/flows/search-documents.ts';
import '@/ai/flows/answer-queries.ts';
// @ts-nocheck
'use server';

import { searchDocuments, SearchDocumentsOutput } from '@/ai/flows/search-documents';
import { z } from 'zod';
import { getDb } from '@/lib/mongodb';
import type { Db } from 'mongodb';

// Define a schema for the form data, now only containing the query.
const formSchema = z.object({
  query: z.string().min(1, 'La consulta es obligatoria.').max(500, 'La consulta no puede exceder los 500 caracteres.'),
});

export interface SearchState {
  data?: SearchDocumentsOutput;
  error?: string;
  formErrors?: Record<string, string[] | undefined>;
}

const collectionMap: Record<'circular' | 'instruction' | 'regulation', string> = {
  circular: 'circulares',
  instruction: 'instructivos',
  regulation: 'reglamentos',
};

const buildSearchQuery = (keywords: string[], documentType: 'circular' | 'instruction' | 'regulation' | 'all', year?: number) => {
    const finalConditions: any[] = [];
    const circularNumberRegex = /^\d{1,2}\/\d{2}$/;
    const circularNumberKeyword = keywords.find(k => circularNumberRegex.test(k));

    // High-precision search for a specific circular number
    if (circularNumberKeyword && (documentType === 'circular' || documentType === 'all')) {
        return {
            tipo_normativa: { $regex: "CIRCULAR", $options: 'i' },
            numero: circularNumberKeyword
        };
    }

    const keywordOrConditions: any[] = [];
    // 1. Keyword search logic
    if (keywords && keywords.length > 0) {
        keywords.forEach(keyword => {
            const regex = { $regex: keyword, $options: 'i' };
            
            let textSearchFields: string[] = [];
            const documentTypesToQuery = documentType === 'all' ? ['circular', 'instruction', 'regulation'] : [documentType];

            if (documentTypesToQuery.includes('circular')) {
                textSearchFields.push(
                    'tipo_normativa', 'numero', 'resumen', 'tema', 'palabras_clave',
                    'entidades_afectadas.nombre_entidad', 'entidades_afectadas.tipo', 'entidades_afectadas.tipo_entidad'
                );
            }
            if (documentTypesToQuery.includes('instruction')) {
                textSearchFields.push('titulo', 'resumen', 'palabras_clave', 'tipo_normativa');
            }
            if (documentTypesToQuery.includes('regulation')) {
                textSearchFields.push('titulo_seccion', 'articulos.resumen_articulo', 'articulos.palabras_clave_articulo');
            }
            
            const uniqueTextSearchFields = [...new Set(textSearchFields)];

            uniqueTextSearchFields.forEach(field => {
                keywordOrConditions.push({ [field]: regex });
            });
        });
    }

    if(keywordOrConditions.length > 0) {
        finalConditions.push({ $or: keywordOrConditions });
    }

    // 2. Year search logic
    if (year) {
        const yearShort = year.toString().slice(-2); // e.g., 23
        const yearLong = year.toString(); // e.g., 2023

        const yearOrConditions: any[] = [
            { fecha_expedicion: { $regex: `^${yearLong}`, $options: 'i' } }
        ];

        const documentTypesForYearQuery = documentType === 'all' ? ['circular'] : (documentType === 'circular' ? ['circular'] : []);
        if (documentTypesForYearQuery.includes('circular')) {
             yearOrConditions.push({ 
                $and: [
                    { tipo_normativa: { $regex: "CIRCULAR", $options: 'i' } },
                    { numero: { $regex: `/${yearShort}$`, $options: 'i' } }
                ]
            });
        }
        
        finalConditions.push({ $or: yearOrConditions });
    }
    
    // Combine all "AND" conditions
    if (finalConditions.length === 0) return {};
    
    if (finalConditions.length === 1) return finalConditions[0];
    if (finalConditions.length > 1) return { $and: finalConditions };
    return {};
};


export async function handleSearch(
  prevState: SearchState,
  formData: FormData
): Promise<SearchState> {
  const rawFormData = {
    query: formData.get('query'),
  };

  const parsed = formSchema.safeParse(rawFormData);

  if (!parsed.success) {
    return { error: 'Datos de formulario inválidos.', formErrors: parsed.error.flatten().fieldErrors };
  }

  const { query } = parsed.data;

  try {
    // The Genkit flow is now only responsible for AI logic, not DB access.
    // We pass the DB results to it.
    const result = await searchDocuments({
      query,
    });

     // If the AI asks for DB content, we fetch it here in the server action
     if (result.requiresContext) {
        const db: Db = await getDb();
        let dbResults: any[] = [];
        
        const { documentType = 'all', keywords, year, intent, instructivoType } = result.intentAnalysis || {};
        
        if (intent === 'search_latest') {
          if (documentType === 'instruction') {
            const collection = db.collection(collectionMap.instruction);
            const getNumber = (title: string) => {
                const match = title.match(/^[IE](\d+)/);
                return match ? parseInt(match[1], 10) : 0;
            };

            const findLatest = async (type: 'I' | 'E') => {
                const instructivos = await collection.find({ titulo: { $regex: `^${type}` } }).toArray();
                if (instructivos.length === 0) return null;
                instructivos.sort((a, b) => getNumber(b.titulo || '') - getNumber(a.titulo || ''));
                return instructivos[0];
            };

            if (instructivoType === 'interno') {
                const latest = await findLatest('I');
                if (latest) dbResults.push(latest);
            } else if (instructivoType === 'externo') {
                const latest = await findLatest('E');
                if (latest) dbResults.push(latest);
            } else { // 'ambos' or undefined
                const latestI = await findLatest('I');
                const latestE = await findLatest('E');
                if (latestI) dbResults.push(latestI);
                if (latestE) dbResults.push(latestE);
            }
          } else if (documentType === 'circular') {
            const collection = db.collection(collectionMap.circular);
            const latestCirculares = await collection.find({})
              .sort({ fecha_expedicion: -1 })
              .limit(5)
              .toArray();
            dbResults = latestCirculares;
          }
        } else {
            const collectionsToQuery = documentType === 'all'
            ? Object.values(collectionMap)
            : [collectionMap[documentType as 'circular' | 'instruction' | 'regulation']];
            
            for (const collectionName of collectionsToQuery) {
                const collection = db.collection(collectionName);
                const docTypeForQuery = Object.keys(collectionMap).find(key => collectionMap[key as 'circular' | 'instruction' | 'regulation'] === collectionName) as 'circular' | 'instruction' | 'regulation';
                
                const searchQuery = buildSearchQuery(keywords || [], docTypeForQuery, year);
                const collectionResults = await collection.find(searchQuery).toArray();
                dbResults = dbResults.concat(collectionResults);
            }
        }
        
        const uniqueResults = dbResults.filter((res, index, self) =>
            index === self.findIndex((r) => r._id.toString() === res._id.toString())
        );

        const processedResults = uniqueResults.map(r => {
            const result: any = { ...r, _id: r._id.toString() };
            Object.keys(result).forEach(key => {
                if (result[key] === null || result[key] === undefined) {
                  delete result[key];
                } else if (result[key] instanceof Date) {
                  result[key] = result[key].toISOString();
                }
            });
            if (result.articulos && Array.isArray(result.articulos)) {
              result.articulos = result.articulos.map((articulo: any) => {
                if (articulo && typeof articulo === 'object' && articulo.numero_articulo) {
                    articulo.numero_articulo = String(articulo.numero_articulo);
                }
                return articulo;
              });
            }
            // FIX: Ensure 'palabras_clave' is an array of strings.
            if (result.palabras_clave && typeof result.palabras_clave === 'string') {
              result.palabras_clave = result.palabras_clave.split(',').map((kw: string) => kw.trim());
            }

            return result;
        });

        // Call the flow again, this time with the context
        const finalResult = await searchDocuments({
            query: query,
            context: JSON.stringify(processedResults, null, 2),
            intentAnalysis: result.intentAnalysis,
            dbResults: processedResults, // Pass results for client-side display
        });
        return { data: finalResult };
     }

    return { data: result };
  } catch (e: any) {
    console.error('Error in handleSearch:', e);
    return { error: e.message || 'Ocurrió un error inesperado.' };
  }
}

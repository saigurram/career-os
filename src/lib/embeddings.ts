// Semantic similarity for the never-repeat guarantee on interview questions and
// generated curriculum content. Embeddings come from Voyage AI (Anthropic's
// recommended embeddings partner) via a plain fetch call — no SDK dependency.

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings'
const VOYAGE_MODEL = 'voyage-3.5'
const VOYAGE_OUTPUT_DIMENSION = 1024

interface VoyageEmbeddingResponse {
  data: { embedding: number[]; index: number }[]
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []

  const apiKey = process.env.VOYAGE_API_KEY
  if (!apiKey) throw new Error('VOYAGE_API_KEY is not configured')

  const response = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: texts,
      model: VOYAGE_MODEL,
      input_type: 'document',
      output_dimension: VOYAGE_OUTPUT_DIMENSION,
    }),
  })

  if (!response.ok) {
    throw new Error(`Voyage embeddings request failed: ${response.status} ${await response.text()}`)
  }

  const body = await response.json() as VoyageEmbeddingResponse
  return body.data
    .sort((a, b) => a.index - b.index)
    .map(d => d.embedding)
}

export async function embedText(text: string): Promise<number[]> {
  const [embedding] = await embedBatch([text])
  return embedding
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0

  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

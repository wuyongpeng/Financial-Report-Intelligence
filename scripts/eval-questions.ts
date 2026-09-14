/**
 * Skeleton scorer for golden questions — does NOT call the model.
 * Human scoring fills manualScore later; this only validates the rubric schema.
 */
import goldenQuestions from '../data/golden-questions.json';

type Q = {
  id: string;
  question: string;
  kind: string;
  expectedMetric?: string;
  expectedTerms?: string[];
  rubric?: string;
  expectCitations?: boolean;
  expectNumeric?: boolean;
  manualScore?: number | null;
};

const rows = goldenQuestions as Q[];
let ok = 0;
for (const q of rows) {
  const scorable = Boolean(q.kind) && Boolean(q.expectedMetric || q.expectedTerms?.length || q.rubric);
  const mark = scorable ? 'OK' : 'MISSING';
  if (scorable) ok += 1;
  console.log(`${mark}\t${q.id}\t${q.kind}\t${q.question}`);
}
console.log(`\n${ok}/${rows.length} questions have scoring fields`);
if (ok < rows.length || rows.length < 20) process.exitCode = 1;

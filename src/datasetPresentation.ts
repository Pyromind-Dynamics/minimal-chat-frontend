export function visibleDatasetDistributions(distributions: Record<string, Record<string, number>>, sampleCount: number | null) {
  return Object.entries(distributions).filter(([name, counts]) => {
    const dimension = name.toLowerCase();
    if (dimension === 'category') return false;
    const entries = Object.entries(counts);
    return !(['split', 'task'].includes(dimension) && entries.length === 1 && sampleCount !== null && entries[0][1] === sampleCount);
  });
}

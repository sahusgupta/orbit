export function dependencyReviewFailures(scope, vulnerabilities, review, lock) {
  const failures = [];
  const allowed = new Set(review?.allowed || []);
  const observed = new Set(vulnerabilities.map((entry) => entry.name));
  for (const entry of vulnerabilities) {
    const name = entry.name;
    if (!allowed.has(name)) {
      failures.push(`${scope}:${name} is not in the reviewed policy.`);
      continue;
    }
    const reviewedSeverity = review.reviewedSeverities?.[name] ?? 'high';
    if (!['low', 'moderate', 'high'].includes(reviewedSeverity)) {
      failures.push(`${scope}:${name} has invalid reviewed severity ${reviewedSeverity}.`);
    }
    if (entry.severity === 'critical' || entry.severity !== reviewedSeverity) {
      failures.push(`${scope}:${name} has unreviewed severity ${entry.severity}.`);
    }
    if (!entry.nodes?.length || !entry.via?.length) failures.push(`${scope}:${name} has incomplete advisory evidence.`);
    for (const node of entry.nodes || []) {
      const version = lock.packages?.[node]?.version;
      if (!version || !review.reviewedVersions?.[name]?.includes(version)) {
        failures.push(`${scope}:${name} has unreviewed locked version ${version || 'missing'}.`);
      }
    }
    for (const origin of entry.via || []) {
      if (typeof origin === 'string') {
        if (!allowed.has(origin) || !observed.has(origin)) failures.push(`${scope}:${name} has unreviewed dependency ${origin}.`);
      } else if (origin.severity === 'critical' || origin.severity !== reviewedSeverity || !review.reviewedAdvisories?.[name]?.includes(origin.url)) {
        failures.push(`${scope}:${name} has an unreviewed or critical originating advisory ${origin.url}.`);
      }
    }
  }
  return failures;
}

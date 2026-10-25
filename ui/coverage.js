export const COVERAGE_NOTICE = 'Credential-phishing checks only. TLS certificates, non-credential mixed content, and malware are not assessed.';
export function coverageLabel(result = {}) {
  if (result.state === 'trusted') return 'Credential-phishing protection paused';
  if (result.state === 'failed') return 'Credential-phishing scan failed';
  if (result.state === 'unsupported') return 'Credential-phishing scan unavailable';
  if (result.state === 'scanning') return 'Scanning credential-phishing indicators';
  if (result.state === 'complete') return result.truncated ? 'Partial credential-phishing scan' : 'Credential-phishing scan complete';
  return 'Waiting for credential-phishing scan';
}

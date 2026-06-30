import LegalPage from '../components/LegalPage';

export default function TermsPage() {
  return <LegalPage contentKey="terms" />;
}

/**
 * Statically pre-rendered at build time.
 * Apple / Google reviewers (and crawlers) receive the full HTML with no JS
 * dependency — the page content is visible in the raw HTTP response.
 */
export async function getStaticProps() {
  return { props: {} };
}

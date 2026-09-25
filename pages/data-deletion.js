import DataDeletionPage from '../components/DataDeletionPage';

export default function DataDeletion() {
  return <DataDeletionPage />;
}

/**
 * Statically pre-rendered at build time — same rationale as pages/privacy.js:
 * Google Play review needs to reach this URL without JS to confirm the app
 * provides an accessible account/data deletion path (the form itself is
 * client-side and requires JS, but the explanation content is not).
 */
export async function getStaticProps() {
  return { props: {} };
}

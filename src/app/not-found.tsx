import Link from "next/link";
export default function NotFound() {
  return (
    <div className="page-container empty-state">
      <span className="eyebrow">404 · Page not found</span>
      <h1>Let’s find something worth knowing.</h1>
      <p>This page doesn’t exist, but there’s plenty to explore.</p>
      <Link className="button primary" href="/">
        Back to The Brief
      </Link>
    </div>
  );
}

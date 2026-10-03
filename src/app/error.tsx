"use client";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <div className="page-container empty-state">
      <h1>Something didn’t quite connect.</h1>
      <p>Please try loading this page again.</p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}

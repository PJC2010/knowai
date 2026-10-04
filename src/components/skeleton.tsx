export function PageSkeleton() {
  return (
    <div className="page-container page-skeleton" role="status">
      <span className="sr-only">Loading the page.</span>
      <div className="skeleton-heading" aria-hidden="true">
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line" />
      </div>
      <div className="skeleton-grid" aria-hidden="true">
        {[0, 1, 2, 3].map((item) => (
          <div className="skeleton-card" key={item}>
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ResponseSkeleton() {
  return (
    <div className="response-skeleton" role="status">
      <span className="sr-only">Waiting for the model response.</span>
      <div aria-hidden="true">
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line" />
      </div>
      <p>Some models take a little longer.</p>
    </div>
  );
}

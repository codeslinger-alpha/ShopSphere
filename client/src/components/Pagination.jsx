// Windowed page numbers around the current page, with the first and last page
// always reachable. "…" marks a jump over the hidden pages.
function pageNumbers(page, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const numbers = new Set([1, totalPages, page]);
  for (const offset of [-1, 1]) {
    const neighbour = page + offset;
    if (neighbour > 1 && neighbour < totalPages) numbers.add(neighbour);
  }

  const sorted = [...numbers].sort((a, b) => a - b);
  const output = [];
  let previous = 0;
  for (const number of sorted) {
    if (previous && number - previous > 1) output.push("gap");
    output.push(number);
    previous = number;
  }
  return output;
}

export default function Pagination({ page, totalPages, onPage }) {
  if (totalPages <= 1) return null;

  return (
    <nav className="pagination" aria-label="Search results pages">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </button>
      {pageNumbers(page, totalPages).map((number, index) =>
        number === "gap" ? (
          <span className="pagination-gap" key={`gap-${index}`}>
            …
          </span>
        ) : (
          <button
            type="button"
            key={number}
            className={number === page ? "active" : undefined}
            aria-current={number === page ? "page" : undefined}
            onClick={() => onPage(number)}
          >
            {number}
          </button>
        ),
      )}
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}

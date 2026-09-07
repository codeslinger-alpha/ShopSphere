import { useParams, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { useAuth } from "../auth/useAuth";
import { api } from "../api/http";
import { useResource, useTask } from "../hooks/useResource";
import { Feedback } from "../components/FormFields";
export default function ProductDetailPage() {
  const { productId } = useParams(),
    { user } = useAuth(),
    task = useTask();
  const product = useResource(`/products/${productId}`),
    reviews = useResource(`/products/${productId}/reviews`),
    eligibility = useResource(
      user?.role === "customer"
        ? `/products/${productId}/review-eligibility`
        : null,
    );
  const p = product.data,
    review = eligibility.data?.review;
  async function save(e) {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.currentTarget));
    if (
      await task.run(() =>
        api(`/products/${productId}/review`, {
          method: "PUT",
          body: JSON.stringify(b),
        }),
      )
    ) {
      reviews.reload();
      eligibility.reload();
    }
  }
  return (
    <main className="content narrow">
      <Link className="link-button" to="/products">
        Back to products
      </Link>
      <Feedback
        error={
          task.error || product.error || reviews.error || eligibility.error
        }
        message={task.message}
      />
      {p && (
        <article className="panel">
          <h1>{p.name}</h1>
          {p.images && (
            <img className="product-image" src={p.images} alt={p.name} />
          )}
          <p>
            {p.shop_name} · {p.manufacturer} · {p.category_name}
          </p>
          <p>
            ${p.unit_price} · {p.in_stock} in stock
          </p>
          <h2>Seller description</h2>
          <div className="markdown">
            <ReactMarkdown>
              {p.description || "No seller description."}
            </ReactMarkdown>
          </div>
          <h2>Master product details</h2>
          <div className="markdown">
            <ReactMarkdown>{p.master_description || ""}</ReactMarkdown>
          </div>
          {p.attributes?.map((a) => (
            <p key={a.name}>
              {a.name}: {a.attrib_value}
            </p>
          ))}
        </article>
      )}
      <h2>Product reviews</h2>
      {reviews.data?.length === 0 && <p>No reviews yet.</p>}
      {reviews.data?.map((r) => (
        <article className="panel" key={r.user_id}>
          <strong>
            {r.name} · {r.rating}/5
          </strong>
          <p className="review-text">{r.review}</p>
          <small>Updated {new Date(r.last_modified).toLocaleString()}</small>
        </article>
      ))}
      {eligibility.data?.eligible ? (
        <form
          className="panel form"
          key={review?.last_modified || "new"}
          onSubmit={save}
        >
          <h2>{review ? "Edit your review" : "Write a review"}</h2>
          <p>
            Verified delivered purchase. User ID and modification time are
            recorded automatically.
          </p>
          <label>
            Rating
            <select name="rating" defaultValue={review?.rating || 5}>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} stars
                </option>
              ))}
            </select>
          </label>
          <label>
            Review
            <textarea
              name="review"
              rows="5"
              maxLength="10000"
              defaultValue={review?.review || ""}
            />
          </label>
          <button className="primary" disabled={task.busy}>
            Save review
          </button>
          {review && (
            <button
              type="button"
              disabled={task.busy}
              onClick={async () => {
                if (
                  await task.run(() =>
                    api(`/products/${productId}/review`, { method: "DELETE" }),
                  )
                ) {
                  reviews.reload();
                  eligibility.reload();
                }
              }}
            >
              Delete my review
            </button>
          )}
        </form>
      ) : (
        user?.role === "customer" &&
        eligibility.data && (
          <p>Reviews unlock after a delivered purchase of this shop listing.</p>
        )
      )}
    </main>
  );
}

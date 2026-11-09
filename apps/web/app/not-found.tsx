import Link from "next/link";

export default function NotFound() {
  return (
    <div className="state-page">
      <p className="kicker">404</p>
      <h1>That page is not on Seedix</h1>
      <p className="lede">The coin or route does not exist. The board is the place to start.</p>
      <p className="stack-top">
        <Link className="btn" href="/">
          Back to coins
        </Link>
      </p>
    </div>
  );
}

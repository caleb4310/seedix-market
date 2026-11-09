export default function Loading() {
  return (
    <div className="state-page" role="status">
      <p className="kicker">Loading</p>
      <h1>Fetching the page</h1>
      <p className="lede">Mock coins load locally. A live pool quote waits for the testnet.</p>
    </div>
  );
}

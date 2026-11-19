import { howItWorks } from "@/lib/howItWorks";

export function HowItWorks() {
  return (
    <section id="how-it-works" className="how" aria-labelledby="how-title">
      <div>
        <p className="kicker">How it works</p>
        <h2 id="how-title">From launch to kickback</h2>
      </div>
      <ol className="how-steps">
        {howItWorks.map((step, index) => (
          <li key={step.title}>
            <span className="how-num">{index + 1}</span>
            <strong>{step.title}</strong>
            <p>{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

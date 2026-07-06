type PlaceholderPageProps = {
  title: string;
  eyebrow: string;
  description: string;
  items: string[];
};

export function PlaceholderPage({ title, eyebrow, description, items }: PlaceholderPageProps) {
  return (
    <main className="page">
      <section className="empty-page">
        <div className="section-kicker">{eyebrow}</div>
        <h1 className="title title-large">{title}</h1>
        <p className="empty-copy">{description}</p>
        <div className="placeholder-list">
          {items.map((item) => (
            <div className="placeholder-row" key={item}>
              <span className="status-dot" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

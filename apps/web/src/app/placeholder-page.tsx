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
        <div className="empty-page-head">
          <div className="section-kicker">{eyebrow}</div>
          <span className="badge-soon">Em breve</span>
        </div>
        <h1 className="title title-large">{title}</h1>
        <p className="empty-copy">{description}</p>
        <div className="placeholder-list-label">O que está previsto</div>
        <div className="placeholder-list">
          {items.map((item) => (
            <div className="placeholder-row" key={item}>
              <span className="dot-planned" aria-hidden="true" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

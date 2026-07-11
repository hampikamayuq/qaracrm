import { redirect } from 'next/navigation';

// /settings era um placeholder "Em breve" — contra o princípio "nada fake"
// do PRODUCT.md. Com as seções reais no ar, vira só a porta de entrada.
export default function SettingsPage() {
  redirect('/settings/channels');
}

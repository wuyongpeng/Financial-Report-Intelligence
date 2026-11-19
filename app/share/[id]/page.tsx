import ShareView from './share-view';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: '问答分享 · Eva' };
}

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ShareView id={id} />;
}

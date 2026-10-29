'use client';

import { useEffect, useId, useRef, useState } from 'react';

export default function MermaidBlock({ chart }: { chart: string }) {
  const host = useRef<HTMLDivElement>(null);
  const reactId = useId().replace(/:/g, '');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'neutral',
          securityLevel: 'loose',
          flowchart: { htmlLabels: true, curve: 'basis' },
        });
        const { svg } = await mermaid.render(`docs-mermaid-${reactId}`, chart);
        if (!cancelled && host.current) host.current.innerHTML = svg;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [chart, reactId]);

  if (failed) {
    return <pre className="eva-docs-mermaid-fallback"><code className="language-mermaid">{chart}</code></pre>;
  }
  return <div className="eva-docs-mermaid" ref={host} role="img" aria-label="用法流程图" />;
}

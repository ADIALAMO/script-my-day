import { useState } from 'react';
import { Copy, Download, Share2, Check } from 'lucide-react';

function ScriptOutput({ script, lang }) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(script);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([script], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'life_script.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!script) return null;

  return (
    <div className="mt-12 space-y-6">
      <div className="flex justify-between items-center px-2">
        <h2 className="text-gold font-bold uppercase tracking-widest text-sm italic">Final Cut</h2>
        <div className="flex gap-2">
          <button onClick={handleCopy} className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-all">
            {isCopied ? <Check size={18} className="text-green-500" /> : <Copy size={18} />}
          </button>
          <button onClick={handleDownload} className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-all">
            <Download size={18} />
          </button>
        </div>
      </div>

      <div className="bg-white text-black p-8 md:p-12 shadow-[0_20px_50px_rgba(0,0,0,0.5)] rounded-sm min-h-[500px] script-paper">
        <pre className="whitespace-pre-wrap font-courier text-sm md:text-base leading-relaxed uppercase">
          {script}
        </pre>
      </div>
    </div>
  );
}

export default ScriptOutput;
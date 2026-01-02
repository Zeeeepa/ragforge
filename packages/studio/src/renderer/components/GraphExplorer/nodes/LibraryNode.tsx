import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Package, ExternalLink } from 'lucide-react';

interface LibraryData {
  name?: string;
  version?: string;
  source?: string; // npm, pypi, etc.
  isSearchResult?: boolean;
  score?: number;
}

function LibraryNode({ id, data, selected }: NodeProps<LibraryData>) {
  const handleOpenLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    const name = data.name || '';

    // Try to determine the package registry
    let url = '';
    if (data.source === 'pypi' || name.includes('python')) {
      url = `https://pypi.org/project/${name}/`;
    } else {
      // Default to npm
      url = `https://www.npmjs.com/package/${name}`;
    }

    window.open(url, '_blank');
  };

  return (
    <div
      className={`relative bg-gray-800 rounded-lg shadow-lg border-2 transition-all min-w-[140px] max-w-[200px] ${
        selected
          ? 'border-cyan-400'
          : data.isSearchResult
          ? 'border-green-500/50'
          : 'border-cyan-700/50 hover:border-cyan-600'
      }`}
    >
      {/* Search result indicator */}
      {data.isSearchResult && data.score !== undefined && (
        <div className="absolute -top-2 -right-2 bg-green-600 text-white text-xs px-1.5 py-0.5 rounded-full font-mono">
          {data.score.toFixed(2)}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-t-lg bg-cyan-900/50 text-cyan-300">
        <Package className="w-3.5 h-3.5" />
        <span className="text-xs font-medium uppercase tracking-wide opacity-80">
          Library
        </span>
        <button
          onClick={handleOpenLink}
          className="ml-auto opacity-60 hover:opacity-100"
          title="Open on npm/pypi"
        >
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>

      {/* Content */}
      <div className="px-3 py-2">
        <p className="font-mono text-sm font-medium truncate text-cyan-100" title={data.name}>
          {data.name || 'Unknown'}
        </p>
        {data.version && (
          <p className="font-mono text-xs text-cyan-400/70 mt-0.5">
            v{data.version}
          </p>
        )}
      </div>

      {/* Handles */}
      <Handle
        type="target"
        position={Position.Top}
        className="w-2 h-2 !bg-cyan-400"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-2 h-2 !bg-cyan-400"
      />
    </div>
  );
}

export default memo(LibraryNode);

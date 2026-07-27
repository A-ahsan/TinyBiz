import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import './SearchableSelect.css';

/**
 * Dropdown with type-to-filter, for pickers that can hold dozens of entries
 * (buyers, sellers, products). Options: [{ value, label }].
 */
const SearchableSelect = ({
  options = [],
  value = '',
  onChange,
  placeholder = 'Select...',
  emptyText = 'No matches found',
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const selected = options.find(option => option.value === value) || null;

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return options;
    return options.filter(option => option.label.toLowerCase().includes(term));
  }, [options, query]);

  // Keep the highlight inside the filtered list as the user types.
  const activeIndex = filtered.length === 0 ? -1 : Math.min(highlight, filtered.length - 1);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) close();
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const openList = () => {
    if (disabled) return;
    setQuery('');
    setHighlight(Math.max(0, options.findIndex(option => option.value === value)));
    setOpen(true);
  };

  const pick = (option) => {
    onChange(option.value);
    close();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight(prev => Math.min(prev + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight(prev => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeIndex >= 0) pick(filtered[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  return (
    <div className="searchable-select" ref={rootRef}>
      {open ? (
        <div className="ss-search">
          <Search size={16} className="ss-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="ss-input"
            value={query}
            placeholder="Type to search..."
            onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
            onKeyDown={handleKeyDown}
          />
        </div>
      ) : (
        <button
          type="button"
          className={`ss-trigger ${selected ? '' : 'is-placeholder'}`}
          onClick={openList}
          disabled={disabled}
        >
          <span className="ss-trigger-text">{selected ? selected.label : placeholder}</span>
          <ChevronDown size={16} />
        </button>
      )}

      {open && (
        <ul className="ss-list" role="listbox">
          {filtered.length === 0 ? (
            <li className="ss-empty">{emptyText}</li>
          ) : filtered.map((option, index) => (
            <li key={option.value} role="option" aria-selected={option.value === value}>
              <button
                type="button"
                className={`ss-option ${index === activeIndex ? 'is-active' : ''} ${option.value === value ? 'is-selected' : ''}`}
                onMouseEnter={() => setHighlight(index)}
                onMouseDown={(e) => { e.preventDefault(); pick(option); }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default SearchableSelect;

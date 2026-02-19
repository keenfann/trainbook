import { FaXmark } from 'react-icons/fa6';
import AnimatedModal from '../../../ui/modal/AnimatedModal.jsx';

function ExternalLibraryModal({
  open,
  onClose,
  libraryQuery,
  onLibraryQueryChange,
  libraryLoading,
  libraryResults,
  onAddFromLibrary,
  formatMuscleLabel,
}) {
  if (!open) return null;

  return (
    <AnimatedModal onClose={onClose} panelClassName="routine-modal">
      <div className="split modal-header">
        <div className="section-title" style={{ marginBottom: 0 }}>
          Add from external library
        </div>
        <button
          className="button ghost icon-button"
          type="button"
          aria-label="Close external library"
          title="Close"
          onClick={onClose}
        >
          <FaXmark aria-hidden="true" />
        </button>
      </div>
      <div className="stack" style={{ marginTop: '1rem' }}>
        <div>
          <label>Search library by exercise name</label>
          <input
            className="input"
            placeholder="e.g. bench press"
            value={libraryQuery}
            onChange={(event) => onLibraryQueryChange(event.target.value)}
          />
        </div>
        {libraryLoading ? <div className="muted">Searching library…</div> : null}
        {!libraryLoading && libraryQuery.trim() && !libraryResults.length ? (
          <div className="muted">No external library matches.</div>
        ) : null}
        {!libraryLoading && libraryResults.length ? (
          <div className="stack">
            {libraryResults.slice(0, 12).map((item) => (
              <div key={item.forkId} className="split" style={{ gap: '0.75rem' }}>
                <div className="inline" style={{ gap: '0.75rem', alignItems: 'center' }}>
                  {item.imageUrls?.[0] ? (
                    <img
                      src={item.imageUrls[0]}
                      alt={item.name}
                      style={{ width: 52, height: 52, borderRadius: '10px', objectFit: 'cover' }}
                    />
                  ) : null}
                  <div>
                    <div style={{ fontWeight: 600 }}>{item.name}</div>
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      {item.primaryMuscles?.length
                        ? item.primaryMuscles.map((muscle) => formatMuscleLabel(muscle)).join(', ')
                        : 'Unspecified'}
                    </div>
                  </div>
                </div>
                <button
                  className="button ghost"
                  type="button"
                  disabled={item.alreadyAdded}
                  onClick={() => onAddFromLibrary(item.forkId)}
                >
                  {item.alreadyAdded ? 'Added' : 'Add'}
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </AnimatedModal>
  );
}

export default ExternalLibraryModal;

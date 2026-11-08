import { hideToast, useToast } from '../toast';

/** The note at the bottom ("„Milch“ gelöscht – Rückgängig"). */
export function Toast() {
  const toast = useToast();
  if (!toast) return null;
  return (
    <div className="snackbar snackbar--toast" role="status" key={toast.id}>
      <span>{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action!.run();
            hideToast();
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}

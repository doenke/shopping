/** Draft of the unified design: switched on with ?design=neu, off with ?design=alt (remembered per device). */
export function designPreview(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('design');
    if (q === 'neu') localStorage.setItem('design-preview', '1');
    if (q === 'alt') localStorage.removeItem('design-preview');
    return localStorage.getItem('design-preview') === '1';
  } catch {
    return false;
  }
}

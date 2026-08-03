export default function CurrencyIcon({ src, label, onError, className }) {
  return (
    <span className="currency-icon-tooltip" data-tooltip={label}>
      <img className={className} src={src} onError={onError} alt="" aria-hidden="true" />
    </span>
  );
}

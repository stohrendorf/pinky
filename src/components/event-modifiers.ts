type EventHandler<E extends Event> = (event: E) => void;

export function preventDefault<E extends Event>(
  handler: EventHandler<E>,
): EventHandler<E> {
  return (event) => {
    event.preventDefault();
    handler(event);
  };
}

export function stopPropagation<E extends Event>(
  handler?: EventHandler<E>,
): EventHandler<E> {
  return (event) => {
    event.stopPropagation();
    handler?.(event);
  };
}

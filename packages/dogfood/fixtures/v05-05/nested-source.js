// SIDPROJ_68_PRIVATE_SENTINEL_NESTED
export function nested(context, value) {
  const first = () => {
    const second = () => context.fillRect(value, 2, 2, 2);
    second();
  };
  first();
}

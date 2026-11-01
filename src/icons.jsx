export function Asset({ name, width, height }) {
  return (
    <img
      src={`/assets/${name}.svg`}
      width={width}
      height={height}
      alt=""
      draggable="false"
    />
  );
}

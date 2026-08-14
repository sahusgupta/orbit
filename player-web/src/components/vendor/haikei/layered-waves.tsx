// Haikei exports design assets rather than React primitives. This component owns
// the two presentations of the generated Layered Waves SVG used by Orbit.
export function HaikeiLayeredWaves() {
  return (
    <>
      <span className="ambient-flow__waves" data-haikei-generator="layered-waves" />
      <span className="ambient-flow__echo" data-haikei-generator="layered-waves" />
      <span className="ambient-flow__seam" />
    </>
  );
}

/// <reference types="vite/client" />

// Declare CSS modules
declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}

// Declare SVG as React components
declare module '*.svg?react' {
  import * as React from 'react';
  const ReactComponent: React.FunctionComponent<React.SVGProps<SVGSVGElement>>;
  export default ReactComponent;
}

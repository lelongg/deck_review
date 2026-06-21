{
  description = "deck — mobile-first GitHub PR reviewer (Vite + React dev shell)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in {
        devShells.default = pkgs.mkShell {
          # Pinned Node toolchain so `npm run dev` / `npm run build` work
          # without a system-wide Node install.
          packages = [
            pkgs.nodejs_22
            pkgs.nodePackages.npm
          ];

          shellHook = ''
            echo "deck dev shell — node $(node --version)"
            echo "  npm install"
            echo "  npm run dev -- --host   # test on a phone over LAN"
            echo "  npm run build           # static bundle in ./dist"
          '';
        };
      });
}

# Package manager

_Note: This is a mono-repo._

## Applications

### Package Manager

The Package Manager connects to to Core, pipes `Expected Packages`, tracks `Expectations` and sends work orders to `Workers`

The Package Manager can be compiled for windows (`apps/package-manager/app-windows/` and ((soon) linux `apps/package-manager/app-linux/`).

### Workforce Orchestrator

The Workforce Orchestrator keeps track of the `Workers` and (upcoming) is able to spin up/down `Workers` depending on the current workload (in coordination with the `Package Manager`).

The Worker can be compiled for windows (`apps/worker/app-windows/` and ((soon) linux `apps/worker/app-linux/`).

### Worker

The Worker receives work orders from the `Package Manager` and executes them.

The Worker can be compiled for windows (`apps/worker/app-windows/` and ((soon) linux `apps/worker/app-linux/`).


## For Developers

Note: Applications are located under `apps/` and libraries are located under `shared/`.

```
yarn
yarn build
yarn lint
```

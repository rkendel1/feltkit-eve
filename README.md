feltkit-eve
Autonomous engineering application built by extending Vercel’s Eve framework.

We kept Eve’s agent foundation and extended it with FeltKit so the application and control plane run on Vercel while consequential agent work executes as a portable WebAssembly artifact on AppBoundry. Resolver rebinds model, repository, and agent behavior at runtime without rebuilding or redeploying the execution artifact. AppPort and AuthBoundry keep every consequential action authorized and backed by inspectable evidence.

An Eve-based application does not have to be coupled to the infrastructure that executes its agents. Deploy the application independently, deploy the execution artifact once, and change what the agent does without redeploying it.

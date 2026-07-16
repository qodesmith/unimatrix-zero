# import/no-namespace

- Confirm wether the package in question actually provides named expoorts. If not, the namespace API is required. Disable the lint rule with a comment and explanation.
- Destructure all values and types used. If names are generic or collide with an existing value, alias the import with a semantic name so they read better.
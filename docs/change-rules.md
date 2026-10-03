# Change Rules

Every rule the classifier can report, by severity. Confidence (`proven` vs
`heuristic`) is a separate axis and is explained in [accuracy.md](accuracy.md).

### Breaking changes (MAJOR)

| Rule                                    | Description                                               |
| --------------------------------------- | --------------------------------------------------------- |
| `export-removed`                        | A public export was removed                               |
| `entrypoint-removed`                    | A public export subpath was removed                       |
| `required-param-added`                  | A required parameter was added to a function              |
| `param-removed`                         | A parameter was removed                                   |
| `param-type-changed`                    | A parameter's type changed                                |
| `return-type-changed`                   | A function's return type changed                          |
| `property-removed`                      | An interface property was removed                         |
| `required-property-added`               | A required property was added to an interface             |
| `property-type-changed`                 | An interface property's type changed                      |
| `interface-property-became-required`    | An optional interface property or method became required  |
| `interface-property-became-readonly`    | An interface property changed from mutable to readonly    |
| `interface-method-removed`              | An interface method was removed                           |
| `required-interface-method-added`       | A required interface method was added                     |
| `interface-method-signature-changed`    | An interface method's signature changed                   |
| `enum-member-removed`                   | An enum member was removed                                |
| `enum-member-value-changed`             | An enum member's value changed                            |
| `class-constructor-changed`             | A class constructor's signature changed                   |
| `class-constructor-visibility-narrowed` | A class constructor's visibility was narrowed (e.g. `public` → `private`) |
| `class-method-removed`                  | A public class method was removed                         |
| `class-method-signature-changed`        | A public class method's signature changed                 |
| `class-method-became-static`            | A class method changed from instance to static            |
| `class-method-became-instance`          | A class method changed from static to instance            |
| `class-property-removed`                | A public class property was removed                       |
| `class-property-type-changed`           | A public class property's type changed                    |
| `class-property-became-static`          | A class property changed from instance to static          |
| `class-property-became-instance`        | A class property changed from static to instance          |
| `class-property-became-required`        | An optional class property became required (review-only)  |
| `required-class-property-added`         | A required instance class property was added (proven when the class was structurally implementable) |
| `class-property-became-readonly`        | A public class property changed from mutable to readonly  |
| `generic-param-required`                | A required generic parameter was added                    |
| `generic-param-removed`                 | A generic parameter was removed                           |
| `generic-constraint-changed`            | A generic parameter's constraint changed                  |
| `generic-param-default-changed`         | A generic parameter's default type changed or was removed |
| `overload-removed`                      | A function overload was removed                           |
| `interface-call-signature-changed`      | An interface's call signatures changed                    |
| `interface-construct-signature-changed` | An interface's construct signatures changed               |
| `index-signature-changed`               | An interface's index signatures changed                   |
| `interface-heritage-changed`            | An interface's `extends` clause changed                   |
| `type-alias-changed`                    | A type alias definition changed                           |
| `variable-type-changed`                 | An exported variable's type changed                       |

### New features (MINOR)

| Rule                                 | Description                                                                             |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| `export-added`                       | A new public export was added                                                           |
| `entrypoint-added`                   | A new public export subpath was added                                                   |
| `optional-param-added`               | An optional parameter was added                                                         |
| `optional-property-added`            | An optional property was added to an interface                                          |
| `interface-method-added`             | An optional interface method was added                                                  |
| `interface-property-became-optional` | A required interface property or method became optional                                 |
| `interface-property-became-mutable`  | An interface property changed from readonly to mutable                                  |
| `enum-member-added`                  | An enum member was added                                                                |
| `overload-added`                     | A function overload was added                                                           |
| `class-constructor-visibility-widened` | A class constructor's visibility was widened (e.g. `private` → `public`)              |
| `generic-param-with-default`         | A generic parameter with a default was added                                            |
| `generic-param-default-added`        | A default was added to an existing generic parameter                                    |
| `class-method-added`                 | A public class method was added                                                         |
| `class-property-added`               | An optional or static public class property was added                                   |
| `class-property-became-optional`     | A required class property became optional                                               |
| `class-property-became-mutable`      | A public class property changed from readonly to mutable                                |
| `param-type-widened`                 | A parameter's type was widened — existing callers still type-check (contravariant)      |
| `return-type-narrowed`               | A function's return type was narrowed — existing consumers still type-check (covariant) |


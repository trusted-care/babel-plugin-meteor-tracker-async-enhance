/**
 * This babel plugin tries to alleviate problems with Meteor Trackers' autoruns & reactive code
 * when used together with async / await.
 *
 * We'll store a copy of the current Tracker.currentComputation inside each async function in your code (!!!)
 * and then we'll restore it *after* each await call, but only in the current functions' context... it's complicated :) .
 *
 * But this seems to allow us, in short, to keep the code reactive even after multiple - and nested - await's.
 *
 * It's maybe not done, but it should be a good proof-of-concept for now.
 *
 * What is still missing?
 *
 * - doesn't work with multiple awaits in a single expression yet. The async function(s) called after the initial await will not have
 *   the context. Can be mitigated by not using multiple awaits in a single line / expression.
 *
 *   If necessary / mitigation strategy:
 *       - pull out the await results into separate lines & assignments and use the results in the operation.
 *
 *       so instead of
 *
 *          const z = await getA() && await getB()
 *
 *       do
 *
 *          const a = await getA()
 *          const b = await getB()
 *          const z = a && b
 *
 *       for example.
 *
 *  - also doesn't work for eg. if/else blocks currently... easiest is to pull out the await returns & decide based on them for now :)
 *
 * - doesn't work with regular old Promise - objects yet. Promise-Objects could be monkey-patched by overriding their constructor
 *   though I think. Ping me if you're interested :)
 *
 *
 * - optimization options:
 *     - Only add
 *
 *        const ____secretCurrentComputation____ = Tracker?.currentComputation || null;
 *
 *      to async functions actually containing awaits in their code.
 *
 * Here is an example for the transformations that will be applied to all async functions & awaits:
 *
 * Turns this code:
 *
 *   async function test() {
 *       const a = await this.getA()
 *       const b = await this.getB()
 *       const c = await this.getC()
 *       return [a, b, c]
 *   }
 *
 *   into this:
 *
 *   async function test() {
     *      const ____secretCurrentComputation____ = Tracker?.currentComputation || null;              // store Tracker.currentComputation if it exists
 *      const a = await this.getA();
 *      return Tracker.withComputation(____secretCurrentComputation____, async () => {             // The first async function still gets the current computation.
 *          const ____secretCurrentComputation____ = Tracker?.currentComputation || null;          // But after that it'll be gone.
 *          const b = await this.getB();                                                           // So we wrap the rest of the functions' body in a
 *          return Tracker.withComputation(____secretCurrentComputation____, async () => {         // Tracker.withComputation *for each await* so it'll keep the autorun global around.
 *              const ____secretCurrentComputation____ = Tracker?.currentComputation || null;      //
 *              const c = await this.getC();                                                       // BUT also so that the autorun will be cleaned up after
 *              return Tracker.withComputation(____secretCurrentComputation____, async () => {     // the block has been executed... which is very important as to
 *                  const ____secretCurrentComputation____ = Tracker?.currentComputation || null;  // not have other, wrong dependencies registered because the Tracker.Autorun context
 *                  return [a, b, c];                                                              // hasn't been removed correctly.
 *              });
 *          });
 *      });
 * }
 *
 */

module.exports = function ({types: t, template, caller}) {
    let callerInfo
    caller(function (c) {
        callerInfo = c
    })

    // detect server/client for Meteor, we only need this for client code
    let isServer = false

    /**
     * Wraps all code in a function *after* an await statement into a Tracker.withComputation - block, recursively
     *
     * @param path
     */
    function wrapFollowingStatementsInBlock(path) {
        // check the block content - for each line containing an await
        let body = path.node.body.body
        for (let i = 0; i < body.length; i++) {
            let stmt = body[i]
            let containsAwait = false

            if (t.isExpressionStatement(stmt) && t.isAwaitExpression(stmt.expression)) {
                containsAwait = true
            } else if (t.isVariableDeclaration(stmt)) {
                for (let declar of stmt.declarations) {
                    if (t.isAwaitExpression(declar.init)) {
                        containsAwait = true
                        break
                    }
                }
            } else if (t.isExpressionStatement(stmt) && t.isAssignmentExpression(stmt.expression) && t.isAwaitExpression(stmt.expression.right)) {
                // Account for assignments with await on the right-hand side
                containsAwait = true
            }

            if (containsAwait) {
                if (i < body.length - 1) {
                    const afterAwait = body.splice(i + 1)

                    const wrapper = template(`
                return Tracker.withComputation(____secretCurrentComputation____, async () => {
                    BODY;
                });
            `)({BODY: afterAwait})
                    body.splice(i + 1, 0, wrapper)
                    i += afterAwait.length // Skip the inserted block
                }
            }
        }
    }

    return {
        visitor: {
            Program: {
                enter(_, state) {
                    isServer = callerInfo?.arch.startsWith('os.')
                },
            },
            Function(path) {
                // only for client code, not server
                if (isServer) {
                    return
                }

                // only for async functions
                if (!path.isFunction() || !path.node.async) {
                    return
                }

                // Ensure the body is a block statement (for arrow functions with expression bodies)
                if (!t.isBlockStatement(path.node.body)) {
                    const originalBody = path.node.body
                    path.node.body = t.blockStatement([t.returnStatement(originalBody)])
                }

                // Add / store the Tracker.currentComputation so it'll be available using lexical scoping
                // in this file, even if the code yielded / was interrupted because of an await:
                const initCode = template.ast(`
                    const ____secretCurrentComputation____ = Tracker?.currentComputation || null;
                `, {preserveComments: true})

                path.get('body').unshiftContainer('body', initCode)

                // Wrap the code following each await statement in a Tracker.withComputation(____secretCurrentComputation____) - block
                wrapFollowingStatementsInBlock(path)
            },
        },
    }
}

# Meteor Tracker patch-async-await Babel Client Plugin 🍝

**This plugin allows you to keep your client side code reactive even when using multiple - and nested - `await` statements inside `Tracker.autorun` contexts.**

**It allows you to not having to add `Tracker.withComputation` statements manually for many common use cases.***

<html>*</html> Terms and Conditions apply :)

## Introduction

This babel plugin tries to alleviate problems with Meteor Trackers' autoruns & reactive code when used together with async / await.

This works by adding additional code to the client code in your app which keeps track of the current computation (_this is what makes Tracker work behind the scenes_) across
async `await` calls / restoring the current computation _after_ a call to `await`.

We store a copy of the current Tracker.currentComputation inside each async function in your code
and then restore it *after* each await call, but only in the current functions' context... it's complicatqed :) .

It's incomplete, but it seems to be a working first version, with limitations.


Here is an example for the transformations that will be applied to all async functions & awaits:

Turns this code:

    async function test() {
        const a = await this.getA()
        const b = await this.getB()
        const c = await this.getC()
        return [a, b, c]
    }

into this:

    async function test() {
        const ____secretCurrentComputation____ = Tracker?.currentComputation || null;              // Store Tracker.currentComputation if it exists.

        const a = await this.getA();
        return Tracker.withComputation(____secretCurrentComputation____, async () => {             // The first async function still gets the current computation.
            const ____secretCurrentComputation____ = Tracker?.currentComputation || null;          // But after that it'll be gone.

            const b = await this.getB();
                                                                                                   
            return Tracker.withComputation(____secretCurrentComputation____, async () => {         // So we wrap the rest of the functions' body in a Tracker.withComputation
                const ____secretCurrentComputation____ = Tracker?.currentComputation || null;      // *for each await statement* so it'll keep the autorun global around after it will continue.

                const c = await this.getC();                                                       // BUT also so that the autorun will be cleaned up after
                return Tracker.withComputation(____secretCurrentComputation____, async () => {     // the block has been executed... which is very important as to
                                                                                                   // not have other, wrong dependencies registered because the Tracker.Autorun context
                    const ____secretCurrentComputation____ = Tracker?.currentComputation || null;  // hasn't been removed correctly.
                    return [a, b, c];                                                              
                });
            });
        });
    }


We know it's not beautiful - but it works.

It helps us keep our complex codebase with lots of helper code reactive for in our blaze project! 🚂 

## Issues & Performace

- Call Stack gets multiple times deeper for async functions, but
- Bundle Size- and Performance - Impact seem to be surprisingly small - _for what it does_.
  - Bundle size: + 10-20% for _your handwritten client code_ (which is probably less than you think). Packages etc aren't impacted out of the box.
  - Performance: Also _possibly_ 10%-ish from our experiments (we ran performance tests using chrome debugger), at most. As this happens mostly on the client, and the client code should be relatively "thin" & limited in scope anyhow, we judged it a fair tradeoff. Most things in the client are more limited by database access, network access / waiting & animations, transitions etc. 

## Limitations

What is still missing?

- doesn't work with multiple awaits in a single expression yet. The async function(s) called after the initial await will not have
  the context. Can be mitigated by not using multiple awaits in a single line / expression.

  If necessary / mitigation strategy:
  - pull out the await results into separate lines & assignments and use the results in the operation.

    so instead of

         const z = await getA() && await getB()

    do

         const a = await getA()
         const b = await getB()
         const z = a && b

    for example.

- also doesn't work for eg. `if/else` blocks currently... easiest is to pull out the await returns & decide based on them for now :)

- doesn't work with regular old Promise - objects yet. Promise-Objects could be monkey-patched by overriding their constructor
  though I think. Ping me if you're interested :)


## Future optimizations and improvement ideas:

- Only add the additional code 

    const ____secretCurrentComputation____ = Tracker?.currentComputation || null;

to async functions actually containing awaits in their code.

- I think I have some ideas on how to extend this to work for more / deeper code cases:
  - pulling `await` results out of expression statements could be possible
  - Restoring the context after loops & block statements could also allow their "bodies" to be covered / supported going forward



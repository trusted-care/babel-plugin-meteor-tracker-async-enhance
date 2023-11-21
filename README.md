# Meteor Tracker async/await Babel Client Plugin 🍝

**This plugin allows you to keep your client side code reactive even when using multiple - and nested - `await` statements inside `Tracker.autorun` contexts.**

**It allows you to not having to add `Tracker.withComputation` statements manually for many common use cases.***

<html>*</html> Terms and Conditions apply, see below 😄

- allows you to skip writing `Tracker.withComputation` explicitly after each `await` for code querying reactive data sources to keep the reactivity.  
- works for code in you `Tracker.autorun` as well as all `async` functions called from autorun contexts.  

## Introduction

This babel plugin tries to alleviate problems with Meteor Trackers' autoruns & reactive code when used together with async / await.

This works by adding additional code to the client code in your app which keeps track of the current computation (_this is what makes Tracker work behind the scenes_) across
async `await` calls / restoring the current computation _after_ a call to `await`.

We store a copy of the current Tracker.currentComputation inside each async function in your code
and then restore it *after* each await call, but only in the current functions' context... it's complicatqed :) .

It's incomplete, but it seems to be a working first version, with limitations.

Here's a sandbox to play & test with: **[Play with it for yourself & see what it does for your client code here!](https://astexplorer.net/#/gist/9aa6a5c7c5d597a48ee70b684ed81cd5/0f3c97b2a16aa8476b369793a8e4bebef89577da)**

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

**[Play with it for yourself & see what it does for your client code here!](https://astexplorer.net/#/gist/9aa6a5c7c5d597a48ee70b684ed81cd5/0f3c97b2a16aa8476b369793a8e4bebef89577da)**

## Issues & Performace

- Call Stack gets multiple times deeper for async functions, but
- Bundle Size- and Performance - Impact seem to be surprisingly small - _for what it does_.
  - Bundle size: + 10-20% for _your handwritten client code_ (which is probably less than you think). Packages etc aren't impacted out of the box.
  - Performance: Also _possibly_ 10%-ish from our experiments (we ran performance tests using chrome debugger), at most. As this happens mostly on the client, and the client code should be relatively "thin" & limited in scope anyhow, we judged it a fair tradeoff. Most things in the client are more limited by database access, network access / waiting & animations, transitions etc. 

## Features & Limitations

This works:

    const reactiveVar = new ReactiveVar(42)

    Tracker.autorun(async () => {
        // basic awaits are supported
        await somethingOrOther()

        // assignments from awaits work
        const a = await Meteor.currentUserAsync()

        // That's all that's guaranteed to work. This always works for the first level of the function body
        // of async functions.

        // normally after the first await you'd have to wrap each reactive call in a Tracker.withComputation() statement
        const b = await Collection1.findOneAsync()
        const c = await Collection2.findOneAsync()

        // in order for your code to stay reactive. But with the bebel plugin you won't need to do this anymore. 
        const myVal = reactiveVar.get()
    })


This probably doesn't work:

    Tracker.autorun(async () => {
        // will probably not work, as we only support basic `await` statements & assignments from `await` statements
        const z = (await a() / Math.floor(await b()) * await c())

        // this probably also won't work as expected yet:
        for (var z0 = 0; z0 < 5; z0++) {
          // we won't inject our code here. Feel free to use Tracker.withComputation manually if you like:
          await abcAsync()
          const z = myReactiveVar.get()
        }

        // but this will:
        // this probably also won't work as expected yet:
        for (var z0 = 0; z0 < 5; z0++) {
          // we won't inject our code here. Feel free to use Tracker.withComputation manually if you like:
          await abc()
          const z = Tracker.withComputation(Tracker.currentComputation, async () => {
              return myReactiveVar.get()
          })
        }

        const myVal = reactiveVar.get()
    })


What is still missing?

- doesn't work with multiple awaits in a single expression (line) yet. The async function(s) called after the initial await will not have
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

- also doesn't work for loops & `if/else` blocks currently... easiest is to pull out the await returns to outside the block statement or use `Tracker.withComputation` manually inside. _If the loop uses an async callback function it'll actually work, as that opens a new async function and inside of that, await & await assignments will work again. _

- doesn't work with regular old Promise - objects yet. Promise-Objects could be monkey-patched by overriding their constructor
  though I think.


## Future optimizations and improvement ideas:

- Only add the additional code to async functions actually containing awaits in their code, otherwise it's not necessary.

- I think I have some ideas on how to extend this to work for more / deeper code cases:
  - pulling `await` results out of expression statements could be possible
  - Restoring the context after loops & block statements could also allow their "bodies" to be covered / supported going forward



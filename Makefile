install:
	pnpm install && pnpm prepare && git submodule update --init --recursive

init-worktree:
	pnpm install && pnpm prepare
	rm -rf harnass && \
	git clone --reference "$$(git rev-parse --git-common-dir)/modules/harnass" "$$(git config submodule.harnass.url)" harnass && \
	git -C harnass checkout "$$(git ls-tree HEAD harnass | awk '{print $$3}')"

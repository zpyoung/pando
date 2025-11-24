class Pando < Formula
  desc "TypeScript CLI for managing Git worktrees"
  homepage "https://github.com/zpyoung/pando"
  version "0.0.1"
  license "MIT"

  on_macos do
    on_intel do
      url "https://github.com/zpyoung/pando/releases/download/v#{version}/pando-v#{version}-darwin-x64.tar.gz"
      sha256 "PLACEHOLDER_DARWIN_X64"
    end
    on_arm do
      url "https://github.com/zpyoung/pando/releases/download/v#{version}/pando-v#{version}-darwin-arm64.tar.gz"
      sha256 "PLACEHOLDER_DARWIN_ARM64"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/zpyoung/pando/releases/download/v#{version}/pando-v#{version}-linux-x64.tar.gz"
      sha256 "PLACEHOLDER_LINUX_X64"
    end
    on_arm do
      url "https://github.com/zpyoung/pando/releases/download/v#{version}/pando-v#{version}-linux-arm64.tar.gz"
      sha256 "PLACEHOLDER_LINUX_ARM64"
    end
  end

  def install
    bin.install "pando"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/pando --version")
  end
end

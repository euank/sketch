package dockerimg

import "testing"

func TestHashCalculationLogging(t *testing.T) {
	initFiles := map[string]string{
		"README.md":                  "# Test Project\nThis is a test",
		".github/workflows/test.yml": "name: test\non: push",
	}

	hash := HashInitFiles(initFiles)
	if hash == "" {
		t.Error("Expected non-empty hash")
	}
	t.Logf("Generated hash: %s", hash)
}

func TestCacheMissDetection(t *testing.T) {
	// Test scenario: Two different sets of init files should produce different hashes
	initFiles1 := map[string]string{
		"README.md": "# Test Project\nThis is a test",
	}

	initFiles2 := map[string]string{
		"README.md": "# Test Project\nThis is a DIFFERENT test", // Changed content
	}

	hash1 := HashInitFiles(initFiles1)
	hash2 := HashInitFiles(initFiles2)

	if hash1 == hash2 {
		t.Error("Expected different hashes for different content")
	}

	t.Logf("Hash 1: %s", hash1)
	t.Logf("Hash 2: %s", hash2)
	t.Logf("Hashes are different: %t", hash1 != hash2)
}
